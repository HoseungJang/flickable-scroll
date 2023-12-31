import { Animator, AnimationMeta } from "./animator";
import { Events } from "./events";
import { Tracker } from "./tracker";
import { clamp } from "./utils/clamp";
import { easeOutCubic } from "./utils/easing";
import { sign } from "./utils/sign";

export interface ScrollerOptions {
  direction?: "x" | "y";
  reverse?: boolean;
  onScrollStart?: (e: ScrollEvent) => void;
  onScrollMove?: (e: ScrollEvent) => void;
  onScrollEnd?: (e: ScrollEvent) => void;
}

type ScrollerEvent = "scrollStart" | "scrollMove" | "scrollEnd";

function scrollerToScrollEvent(scroller: Scroller): ScrollEvent {
  return {
    position: scroller.tracker.position,
    minPosition: scroller.tracker.minPosition,
    maxPosition: scroller.tracker.maxPosition,
    minOverflowPosition: scroller.tracker.minOverflowPosition,
    maxOverflowPosition: scroller.tracker.maxOverflowPosition,
    isScrollTop: scroller.tracker.position >= scroller.tracker.maxPosition,
    isScrollBottom: scroller.tracker.position <= scroller.tracker.minPosition,
  };
}

export interface ScrollEvent {
  position: number;
  minPosition: number;
  maxPosition: number;
  minOverflowPosition: number;
  maxOverflowPosition: number;
  isScrollTop: boolean;
  isScrollBottom: boolean;
}

export class Scroller {
  public readonly container: HTMLElement;
  public readonly children: HTMLElement[];
  public readonly tracker: Tracker;
  public readonly animator: Animator;
  public readonly events: Events<ScrollerEvent, Scroller>;
  private scrollLock = false;
  protected readonly options: ScrollerOptions;

  constructor(container: HTMLElement, options?: ScrollerOptions) {
    this.container = container;
    this.children = Array.prototype.slice.call(this.container.children);
    this.options = options != null ? options : { direction: "y", reverse: false };
    this.tracker = new Tracker(this);
    this.animator = new Animator(this);
    this.events = new Events<ScrollerEvent, Scroller>(this);

    const { onScrollStart, onScrollMove, onScrollEnd } = this.options;
    if (onScrollStart != null) {
      this.events.on("scrollStart", () => onScrollStart(scrollerToScrollEvent(this)));
    }

    if (onScrollMove != null) {
      this.events.on("scrollMove", () => onScrollMove(scrollerToScrollEvent(this)));
    }

    if (onScrollEnd != null) {
      this.events.on("scrollEnd", () => onScrollEnd(scrollerToScrollEvent(this)));
    }
  }

  public get reverse() {
    return this.options.reverse ?? false;
  }

  public get direction() {
    return this.options.direction ?? "y";
  }

  protected start() {
    if (this.scrollLock) {
      return;
    }

    this.animator.stop();
    this.events.emit("scrollStart");
  }

  protected move({ distance }: { distance: number }) {
    if (this.scrollLock) {
      return;
    }

    const distanceRatio = sign(this.tracker.position) !== sign(distance) ? 1 : 1 - this.tracker.overflowRatio;

    this.animator.start([
      {
        startPosition: this.tracker.position,
        distance: distance * distanceRatio,
        duration: 0,
      },
    ]);
    this.events.emit("scrollMove");
  }

  protected end() {
    if (this.scrollLock) {
      return;
    }

    if (this.tracker.position < this.tracker.minPosition) {
      const distance = this.tracker.minPosition - this.tracker.position;

      this.animator.start([
        {
          startPosition: this.tracker.position,
          distance,
          duration: 200,
          easing: easeOutCubic,
        },
      ]);
    } else if (this.tracker.position > this.tracker.maxPosition) {
      const distance = this.tracker.maxPosition - this.tracker.position;

      this.animator.start([
        {
          startPosition: this.tracker.position,
          distance,
          duration: 200,
          easing: easeOutCubic,
        },
      ]);
    } else {
      const animations: AnimationMeta[] = [];

      const { distance, duration } = this.tracker.velocityToDistanceAndDuration();
      animations.push({
        startPosition: this.tracker.position,
        distance,
        duration,
        easing: easeOutCubic,
      });

      const nextPosition = this.tracker.position + distance;
      if (nextPosition <= this.tracker.minPosition) {
        const startPosition = clamp(nextPosition, this.tracker.minOverflowPosition, this.tracker.minPosition);
        const distance = this.tracker.minPosition - startPosition;

        animations.push({
          startPosition,
          distance,
          duration: 300,
          easing: easeOutCubic,
        });
      } else if (nextPosition >= this.tracker.maxPosition) {
        const startPosition = clamp(nextPosition, this.tracker.maxPosition, this.tracker.maxOverflowPosition);
        const distance = this.tracker.maxPosition - startPosition;

        animations.push({
          startPosition,
          distance,
          duration: 300,
          easing: easeOutCubic,
        });
      }

      this.animator.start(animations);
    }

    this.events.emit("scrollEnd");
  }

  public lock() {
    this.scrollLock = true;
  }

  public unlock() {
    this.scrollLock = false;
  }

  public destroy() {
    this.events.purge();
    this.animator.stop();
  }
}

export class TouchScroller extends Scroller {
  private currentTouchPosition: number | null = null;

  constructor(container: HTMLElement, options?: ScrollerOptions) {
    super(container, options);

    this.container.addEventListener("touchstart", this.touchstart);
    this.container.addEventListener("touchmove", this.touchmove);
    this.container.addEventListener("touchend", this.touchend);
  }

  private parseTouch(touch: Touch) {
    return {
      position: this.options.direction === "x" ? touch.clientX : touch.clientY,
    };
  }

  private touchstart = (e: TouchEvent) => {
    const touch = this.parseTouch(e.changedTouches[0]);

    this.currentTouchPosition = touch.position;

    this.start();
  };

  private touchmove = (e: TouchEvent) => {
    if (this.currentTouchPosition == null) {
      return;
    }

    const touch = this.parseTouch(e.changedTouches[0]);
    const distance = touch.position - this.currentTouchPosition;

    this.move({ distance });

    this.currentTouchPosition = touch.position;
  };

  private touchend = () => {
    this.currentTouchPosition = null;
    this.end();
  };

  public destroy() {
    this.container.removeEventListener("touchstart", this.touchstart);
    this.container.removeEventListener("touchmove", this.touchmove);
    this.container.removeEventListener("touchend", this.touchend);
    super.destroy();
  }
}

export class MouseScroller extends Scroller {
  private currentMousePosition: number | null = null;

  constructor(container: HTMLElement, options?: ScrollerOptions) {
    super(container, options);

    this.container.addEventListener("mousedown", this.mousedown);
    this.container.addEventListener("mousemove", this.mousemove);
    this.container.addEventListener("mouseup", this.mouseup);
    this.container.addEventListener("mouseleave", this.mouseup);
  }

  private parseEvent(e: MouseEvent) {
    return {
      position: this.options.direction === "x" ? e.clientX : e.clientY,
    };
  }

  private mousedown = (e: MouseEvent) => {
    const parsed = this.parseEvent(e);

    this.currentMousePosition = parsed.position;
    this.start();
  };

  private mousemove = (e: MouseEvent) => {
    if (this.currentMousePosition == null) {
      return;
    }

    const parsed = this.parseEvent(e);
    const distance = parsed.position - this.currentMousePosition;

    this.move({ distance: distance });

    this.currentMousePosition = parsed.position;
  };

  private mouseup = () => {
    this.currentMousePosition = null;
    this.end();
  };

  public destroy() {
    this.container.removeEventListener("mousedown", this.mousedown);
    this.container.removeEventListener("mousemove", this.mousemove);
    this.container.removeEventListener("mouseup", this.mouseup);
    this.container.removeEventListener("mouseleave", this.mouseup);
    super.destroy();
  }
}
