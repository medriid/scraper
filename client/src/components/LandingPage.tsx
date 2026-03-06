import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, useSpring, AnimatePresence } from "framer-motion";
import * as THREE from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import ScrapexLogo from "./icons/ScrapexLogo";
import AuthModal from "./AuthModal";
import { useAuth } from "../contexts/AuthContext";

gsap.registerPlugin(ScrollTrigger);

// ─── Three.js web-network scene ───────────────────────────────────────────────

function useWebNetworkScene(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 5);

    // ── Particles ────────────────────────────────────────────────────────────
    const NODE_COUNT = 180;
    const positions = new Float32Array(NODE_COUNT * 3);
    const nodePositions: THREE.Vector3[] = [];

    for (let i = 0; i < NODE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.8 + Math.random() * 1.5;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      nodePositions.push(new THREE.Vector3(x, y, z));
    }

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const nodeMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
    });
    const nodesMesh = new THREE.Points(nodeGeo, nodeMat);
    scene.add(nodesMesh);

    // ── Connection lines ─────────────────────────────────────────────────────
    const linePositions: number[] = [];
    const CONNECTION_DIST = 1.4;
    for (let i = 0; i < NODE_COUNT; i++) {
      for (let j = i + 1; j < NODE_COUNT; j++) {
        if (nodePositions[i].distanceTo(nodePositions[j]) < CONNECTION_DIST) {
          linePositions.push(
            nodePositions[i].x, nodePositions[i].y, nodePositions[i].z,
            nodePositions[j].x, nodePositions[j].y, nodePositions[j].z
          );
        }
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePositions), 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.08,
    });
    const linesMesh = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(linesMesh);

    // ── Central X glyph ──────────────────────────────────────────────────────
    const xPoints1 = [new THREE.Vector3(-0.4, -0.4, 0), new THREE.Vector3(0.4, 0.4, 0)];
    const xPoints2 = [new THREE.Vector3(0.4, -0.4, 0), new THREE.Vector3(-0.4, 0.4, 0)];
    const xGeo1 = new THREE.BufferGeometry().setFromPoints(xPoints1);
    const xGeo2 = new THREE.BufferGeometry().setFromPoints(xPoints2);
    const xMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const x1 = new THREE.Line(xGeo1, xMat);
    const x2 = new THREE.Line(xGeo2, xMat.clone());
    const xGroup = new THREE.Group();
    xGroup.add(x1, x2);
    scene.add(xGroup);

    // ── Hexagon ring ─────────────────────────────────────────────────────────
    const hexPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
      hexPoints.push(new THREE.Vector3(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0));
    }
    const hexGeo = new THREE.BufferGeometry().setFromPoints(hexPoints);
    const hexMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
    const hexLine = new THREE.Line(hexGeo, hexMat);
    scene.add(hexLine);

    // ── Animation ─────────────────────────────────────────────────────────────
    let frame = 0;
    let raf: number;
    const mouse = { x: 0, y: 0 };

    const onMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.y = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMove);

    const animate = () => {
      frame++;
      const t = frame * 0.008;

      // Slow sphere rotation
      nodesMesh.rotation.y = t * 0.12;
      linesMesh.rotation.y = t * 0.12;
      nodesMesh.rotation.x = t * 0.04;
      linesMesh.rotation.x = t * 0.04;

      // Mouse parallax
      nodesMesh.rotation.y += mouse.x * 0.0015;
      nodesMesh.rotation.x += mouse.y * 0.0015;
      linesMesh.rotation.y += mouse.x * 0.0015;
      linesMesh.rotation.x += mouse.y * 0.0015;

      // Central elements pulse
      xGroup.rotation.z = Math.sin(t * 0.7) * 0.08;
      xGroup.scale.setScalar(1 + Math.sin(t * 1.3) * 0.04);
      hexLine.rotation.z = -t * 0.15;
      (hexMat as THREE.LineBasicMaterial).opacity = 0.15 + Math.sin(t * 0.9) * 0.1;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      if (!canvas) return;
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    };
  }, [canvasRef]);
}

// ─── Feature cards data ───────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: "⬡",
    title: "Agentic AI",
    desc: "Multi-step agent analyses your target, designs the schema, refines the prompt, and generates code — autonomously.",
  },
  {
    icon: "⌬",
    title: "30+ Models",
    desc: "Gemini 2.5 Pro, Flash, Llama, DeepSeek, Qwen, Claude — pick the best model for speed, quality, or cost.",
  },
  {
    icon: "◈",
    title: "TypeScript Output",
    desc: "Get a production-ready, typed Playwright scraper with pagination, retries, and rate limiting out of the box.",
  },
  {
    icon: "◎",
    title: "Live Streaming",
    desc: "Watch the AI think step-by-step in real time. Code streams token-by-token as it's generated.",
  },
  {
    icon: "⬡",
    title: "Session History",
    desc: "Every session is persisted in Supabase. Revisit generated scrapers, schemas, and prompts any time.",
  },
  {
    icon: "◈",
    title: "JSON Schema",
    desc: "Automatically infers a typed JSON schema from the website structure and your instructions.",
  },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Enter a URL", desc: "Paste any website URL and describe what data you want extracted." },
  { step: "02", title: "AI Analyses", desc: "The agent inspects the site structure, anti-scraping measures, and data patterns." },
  { step: "03", title: "Schema & Prompt", desc: "A typed JSON schema is generated and your instructions are refined for maximum accuracy." },
  { step: "04", title: "Code Streams", desc: "A complete TypeScript scraper with Playwright streams live to your screen, ready to run." },
];

// ─── Landing Page component ───────────────────────────────────────────────────

export default function LandingPage({ onEnterApp }: { onEnterApp: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const featuresRef = useRef<HTMLElement>(null);
  const howRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLElement>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const { user, signOut } = useAuth();

  useWebNetworkScene(canvasRef);

  // ── GSAP scroll animations ────────────────────────────────────────────────
  useEffect(() => {
    // Feature cards stagger in
    if (featuresRef.current) {
      gsap.fromTo(
        featuresRef.current.querySelectorAll(".feature-card"),
        { opacity: 0, y: 60 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.1,
          ease: "power2.out",
          scrollTrigger: {
            trigger: featuresRef.current,
            start: "top 80%",
          },
        }
      );
    }

    // How-it-works steps slide in from left
    if (howRef.current) {
      gsap.fromTo(
        howRef.current.querySelectorAll(".how-step"),
        { opacity: 0, x: -50 },
        {
          opacity: 1,
          x: 0,
          duration: 0.6,
          stagger: 0.15,
          ease: "power2.out",
          scrollTrigger: {
            trigger: howRef.current,
            start: "top 75%",
          },
        }
      );
    }

    // CTA fade up
    if (ctaRef.current) {
      gsap.fromTo(
        ctaRef.current,
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: "power2.out",
          scrollTrigger: {
            trigger: ctaRef.current,
            start: "top 85%",
          },
        }
      );
    }

    return () => {
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

  // ── Framer scroll-driven hero fade ───────────────────────────────────────
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);
  const heroY = useTransform(scrollY, [0, 400], [0, -60]);
  const canvasScale = useTransform(scrollY, [0, 500], [1, 1.15]);
  const springY = useSpring(heroY, { stiffness: 80, damping: 20 });

  return (
    <div className="landing">
      {/* ── Navbar ──────────────────────────────────────────────────────────── */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-logo">
            <ScrapexLogo size={28} />
            <span>Scrapex</span>
          </div>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            {user ? (
              <>
                <button className="btn-nav-ghost" onClick={signOut}>Sign out</button>
                <button className="btn-nav-primary" onClick={onEnterApp}>Dashboard →</button>
              </>
            ) : (
              <>
                <button className="btn-nav-ghost" onClick={() => setAuthOpen(true)}>Sign in</button>
                <button className="btn-nav-primary" onClick={() => setAuthOpen(true)}>Get started →</button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section ref={heroRef} className="landing-hero">
        {/* Three.js canvas background */}
        <motion.canvas
          ref={canvasRef}
          className="hero-canvas"
          style={{ scale: canvasScale }}
        />
        {/* Radial gradient overlay */}
        <div className="hero-gradient" />

        <motion.div className="hero-content" style={{ opacity: heroOpacity, y: springY }}>
          <motion.div
            className="hero-badge"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <span className="badge-dot" />
            AI-powered web extraction
          </motion.div>

          <motion.h1
            className="hero-title"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
          >
            Scrape any website
            <br />
            <span className="hero-title-accent">with a single prompt</span>
          </motion.h1>

          <motion.p
            className="hero-sub"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55 }}
          >
            Give Scrapex a URL and instructions. The AI agent analyses the site,
            designs a schema, refines your prompt, and writes a production-ready
            TypeScript scraper — live, step by step.
          </motion.p>

          <motion.div
            className="hero-cta-row"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
          >
            {user ? (
              <button className="hero-btn-primary" onClick={onEnterApp}>
                Open Dashboard →
              </button>
            ) : (
              <>
                <button className="hero-btn-primary" onClick={() => setAuthOpen(true)}>
                  Start scraping free
                </button>
                <button className="hero-btn-ghost" onClick={onEnterApp}>
                  Try without account →
                </button>
              </>
            )}
          </motion.div>

          <motion.div
            className="hero-scroll-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 0.6 }}
          >
            <span>scroll to explore</span>
            <div className="scroll-line" />
          </motion.div>
        </motion.div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────────── */}
      <section ref={featuresRef} id="features" className="landing-section">
        <div className="landing-container">
          <div className="section-header">
            <h2>Everything you need to extract the web</h2>
            <p>A full agentic pipeline, not just a prompt box.</p>
          </div>
          <div className="features-grid">
            {FEATURES.map((f, i) => (
              <div className="feature-card" key={i}>
                <div className="feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section ref={howRef} id="how" className="landing-section landing-section-alt">
        <div className="landing-container">
          <div className="section-header">
            <h2>How Scrapex works</h2>
            <p>Four automated steps from URL to production code.</p>
          </div>
          <div className="how-steps">
            {HOW_IT_WORKS.map((s) => (
              <div className="how-step" key={s.step}>
                <div className="how-step-num">{s.step}</div>
                <div className="how-step-content">
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
                <div className="how-step-line" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────────── */}
      <section ref={ctaRef} className="landing-cta-section">
        <div className="landing-container">
          <div className="cta-box">
            <ScrapexLogo size={48} />
            <h2>Ready to extract the web?</h2>
            <p>Start scraping any website in under a minute — no credit card required.</p>
            <div className="hero-cta-row">
              {user ? (
                <button className="hero-btn-primary" onClick={onEnterApp}>Open Dashboard →</button>
              ) : (
                <>
                  <button className="hero-btn-primary" onClick={() => setAuthOpen(true)}>Create free account</button>
                  <button className="hero-btn-ghost" onClick={onEnterApp}>Try without account →</button>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-inner">
            <div className="landing-logo">
              <ScrapexLogo size={20} />
              <span>Scrapex</span>
            </div>
            <p>Agentic Web Extraction · Powered by Gemini &amp; OpenRouter</p>
          </div>
        </div>
      </footer>

      {/* ── Auth modal ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {authOpen && (
          <AuthModal
            onClose={() => setAuthOpen(false)}
            onSuccess={() => { setAuthOpen(false); onEnterApp(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
