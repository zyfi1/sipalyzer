/// <reference types="vite/client" />

// React 19 uses React.JSX; @react-three/fiber extends global JSX. Merge three elements into React.JSX.
import type { ThreeElements } from "@react-three/fiber";
declare module "react" {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module "*.png" {
  const value: string;
  export default value;
}

declare module "*.jpg" {
  const value: string;
  export default value;
}

declare module "*.jpeg" {
  const value: string;
  export default value;
}

declare module "*.svg" {
  const value: string;
  export default value;
}

declare module "*.gif" {
  const value: string;
  export default value;
}

declare module "*.webp" {
  const value: string;
  export default value;
}
