interface Props {
  current: number; // 0=config, 1=running, 2=results
}

const STEPS = [
  { label: "Configure" },
  { label: "Agent Session" },
  { label: "Results" },
];

export default function StepBar({ current }: Props) {
  return (
    <div className="steps-bar">
      {STEPS.map((s, i) => (
        <div key={i} className="step-item">
          <span
            className={`step-num ${
              i === current
                ? "step-num--active"
                : i < current
                ? "step-num--done"
                : ""
            }`}
          >
            {i < current ? "✓" : i + 1}
          </span>
          <span
            className={`step-label ${i === current ? "step-label--active" : ""}`}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && <div className="step-connector" />}
        </div>
      ))}
    </div>
  );
}
