import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import scraperRouter from "./routes/scraper.js";
import modelsRouter from "./routes/models.js";
import authRouter from "./routes/auth.js";
import teamsRouter from "./routes/teams.js";
import { checkDatabaseConnection } from "./services/supabaseService.js";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ─── Security ────────────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://openrouter.ai", "https://generativelanguage.googleapis.com", "https://*.supabase.co", "https://*.googleapis.com"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);

const allowedOrigins = [
  process.env.CLIENT_URL ?? "http://localhost:5173",
  /\.herokuapp\.com$/,
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server
      for (const allowed of allowedOrigins) {
        if (typeof allowed === "string" && allowed === origin) return cb(null, true);
        if (allowed instanceof RegExp && allowed.test(origin)) return cb(null, true);
      }
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// ─── Rate limiting ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

const staticLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use("/api/scraper", scraperRouter);
app.use("/api/models", modelsRouter);
app.use("/api/auth", authRouter);
app.use("/api/teams", teamsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

app.get("/api/db-status", async (_req, res) => {
  const result = await checkDatabaseConnection();
  res.status(result.connected ? 200 : 503).json(result);
});

// ─── Serve built client in production ────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "../../client/dist");
  app.use(staticLimiter);
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀  Server running on http://localhost:${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV ?? "development"}`);
});

export default app;
