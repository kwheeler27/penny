import { Children, isValidElement, type ReactNode } from "react";
import { useScrollSteps, type UseScrollStepsOptions } from "./useScrollSteps";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export interface ScrollStepRenderProps {
  readonly index: number;
  readonly isActive: boolean;
  readonly prefersReducedMotion: boolean;
}

export interface ScrollStepContainerProps extends UseScrollStepsOptions {
  /** One child per step, in order. Each may be a plain node or a render-prop function receiving { index, isActive, prefersReducedMotion } — the latter is how a report page swaps the Sankey's highlighted category as the reader scrolls. */
  readonly children: ReactNode | ((props: ScrollStepRenderProps) => ReactNode);
  readonly stepCount: number;
  readonly className?: string;
  /** Minimum viewport height per step, so a step has room to cross the active line before the next one arrives. Default "100vh". */
  readonly minStepHeight?: string;
}

/**
 * Minimal scroll-step primitive: renders `stepCount` full-height (by
 * default) wrapper sections and reports which one is "active" via
 * onStepChange, using IntersectionObserver — no scroll-jacking, no layout
 * assumptions about what's inside a step. Respects prefers-reduced-motion
 * by exposing it to children rather than animating anything itself; a
 * consumer's step transitions should read this flag and skip motion when
 * it's true.
 */
export function ScrollStepContainer({
  children,
  stepCount,
  className,
  minStepHeight = "100vh",
  activeLineFraction,
  onStepChange,
}: ScrollStepContainerProps) {
  const { stepRef, activeIndex } = useScrollSteps(stepCount, { activeLineFraction, onStepChange });
  const prefersReducedMotion = usePrefersReducedMotion();

  const renderStep = (index: number): ReactNode => {
    const isActive = activeIndex === index;
    if (typeof children === "function") {
      return children({ index, isActive, prefersReducedMotion });
    }
    const childArray = Children.toArray(children);
    const child = childArray[index];
    return isValidElement(child) ? child : child ?? null;
  };

  return (
    <div className={className} data-buck-scroll-steps>
      {Array.from({ length: stepCount }, (_, index) => (
        <section
          key={index}
          ref={stepRef(index)}
          data-buck-scroll-step={index}
          data-buck-scroll-step-active={activeIndex === index}
          style={{ minHeight: minStepHeight }}
        >
          {renderStep(index)}
        </section>
      ))}
    </div>
  );
}
