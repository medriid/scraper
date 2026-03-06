import { motion } from "framer-motion";

interface Props {
  schema: Record<string, unknown>;
}

function inferType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export default function SchemaViewer({ schema }: Props) {
  const fields = Object.entries(schema);

  return (
    <div>
      <div
        style={{
          fontSize: "0.8rem",
          color: "var(--text-3)",
          marginBottom: "var(--space-md)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {fields.length} field{fields.length !== 1 ? "s" : ""} detected
      </div>
      <div className="schema-grid">
        {fields.map(([key, value], i) => (
          <motion.div
            key={key}
            className="schema-field"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.04 }}
          >
            <div className="schema-field-key">{key}</div>
            <div className="schema-field-type">{inferType(value)}</div>
            {typeof value === "string" && value && (
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "var(--text-4)",
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {String(value).slice(0, 40)}
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Raw JSON */}
      <details style={{ marginTop: "var(--space-lg)" }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: "0.8rem",
            color: "var(--text-3)",
            fontFamily: "var(--font-mono)",
            userSelect: "none",
          }}
        >
          Raw JSON
        </summary>
        <pre
          style={{
            marginTop: "var(--space-sm)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "var(--space-md)",
            fontSize: "0.78rem",
            color: "var(--text-2)",
            overflow: "auto",
            maxHeight: 300,
            fontFamily: "var(--font-mono)",
            lineHeight: 1.7,
          }}
        >
          {JSON.stringify(schema, null, 2)}
        </pre>
      </details>
    </div>
  );
}
