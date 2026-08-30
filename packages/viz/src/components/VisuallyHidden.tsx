import type { CSSProperties, ReactNode } from "react";

const style: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Standard visually-hidden-but-screen-reader-visible wrapper — used for the SVG's text alternative and other content that must exist in the accessibility tree without taking visual space. */
export function VisuallyHidden({ children, as: Component = "span", id }: { children: ReactNode; as?: "span" | "p" | "div"; id?: string }) {
  return (
    <Component style={style} id={id}>
      {children}
    </Component>
  );
}
