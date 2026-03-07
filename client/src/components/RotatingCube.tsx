import { motion } from "framer-motion";

interface RotatingCubeProps {
  size?: number;
  color?: string;
}

/**
 * A CSS 3D rotating cube rendered with Framer Motion transforms.
 * Keeps the look consistent with the dark monochrome design system.
 */
export default function RotatingCube({ size = 14, color = "var(--text-3)" }: RotatingCubeProps) {
  const s = size;
  const half = s / 2;

  // Each successive face is slightly more transparent to give depth to the cube
  const OPACITY_STEP = 0.08;

  // Faces: front, back, left, right, top, bottom
  const faces: React.CSSProperties[] = [
    { transform: `translateZ(${half}px)` },
    { transform: `rotateY(180deg) translateZ(${half}px)` },
    { transform: `rotateY(-90deg) translateZ(${half}px)` },
    { transform: `rotateY(90deg) translateZ(${half}px)` },
    { transform: `rotateX(90deg) translateZ(${half}px)` },
    { transform: `rotateX(-90deg) translateZ(${half}px)` },
  ];

  return (
    <div
      style={{
        width: s,
        height: s,
        perspective: s * 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <motion.div
        style={{
          width: s,
          height: s,
          position: "relative",
          transformStyle: "preserve-3d",
        }}
        animate={{ rotateX: 360, rotateY: 360 }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
      >
        {faces.map((style, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 0,
              border: `1px solid ${color}`,
              background: "transparent",
              opacity: 0.7 - i * OPACITY_STEP,
              ...style,
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}
