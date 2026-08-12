/**
 * CricketBg3D.jsx
 * Interactive Three.js background for waiting / innings-break states.
 * Mouse hover & touch drag rotates the scene. No UI controls, no buttons.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function CricketBg3D({ message = 'Waiting for match…' }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const W = mountRef.current.clientWidth;
    const H = mountRef.current.clientHeight;

    // ─── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mountRef.current.appendChild(renderer.domElement);

    // ─── Scene & Camera ───────────────────────────────────────────────────────
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 40);

    // ─── Lighting ─────────────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const pointLight1 = new THREE.PointLight(0x6366f1, 3, 80);
    pointLight1.position.set(20, 20, 20);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x06b6d4, 2, 60);
    pointLight2.position.set(-20, -10, 10);
    scene.add(pointLight2);

    const pointLight3 = new THREE.PointLight(0xf59e0b, 1.5, 50);
    pointLight3.position.set(0, 30, -20);
    scene.add(pointLight3);

    // ─── Cricket balls (red seamed balls) ─────────────────────────────────────
    const ballGroup = new THREE.Group();
    const ballCount = 18;
    const balls     = [];

    for (let i = 0; i < ballCount; i++) {
      const r    = 0.9 + Math.random() * 0.6;
      const geo  = new THREE.SphereGeometry(r, 24, 24);
      // Leather-like material
      const mat  = new THREE.MeshStandardMaterial({
        color    : new THREE.Color().setHSL(0.02 + Math.random() * 0.04, 0.85, 0.35 + Math.random() * 0.1),
        roughness: 0.65,
        metalness: 0.08,
      });
      const mesh = new THREE.Mesh(geo, mat);

      // Seam ring — thin torus on each ball
      const seamGeo = new THREE.TorusGeometry(r + 0.02, 0.05, 8, 40);
      const seamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
      const seam    = new THREE.Mesh(seamGeo, seamMat);
      seam.rotation.x = Math.random() * Math.PI;
      seam.rotation.y = Math.random() * Math.PI;
      mesh.add(seam);

      // Random position in a sphere shell
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const dist  = 10 + Math.random() * 22;
      mesh.position.set(
        dist * Math.sin(phi) * Math.cos(theta),
        dist * Math.sin(phi) * Math.sin(theta),
        dist * Math.cos(phi),
      );

      mesh.userData = {
        rotSpeedX: (Math.random() - 0.5) * 0.012,
        rotSpeedY: (Math.random() - 0.5) * 0.012,
        floatAmp  : 0.3 + Math.random() * 0.7,
        floatSpeed: 0.4 + Math.random() * 0.6,
        floatPhase: Math.random() * Math.PI * 2,
        origY     : mesh.position.y,
      };

      ballGroup.add(mesh);
      balls.push(mesh);
    }
    scene.add(ballGroup);

    // ─── Stars (particles) ────────────────────────────────────────────────────
    const starCount = 600;
    const starGeo   = new THREE.BufferGeometry();
    const starPos   = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
      starPos[i] = (Math.random() - 0.5) * 180;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat  = new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.55 });
    const starMesh = new THREE.Points(starGeo, starMat);
    scene.add(starMesh);

    // ─── Ground pitch ─────────────────────────────────────────────────────────
    const pitchGeo = new THREE.CylinderGeometry(8, 8, 0.15, 64);
    const pitchMat = new THREE.MeshStandardMaterial({ color: 0x7c5c3a, roughness: 0.9 });
    const pitch    = new THREE.Mesh(pitchGeo, pitchMat);
    pitch.position.set(0, -15, 0);
    scene.add(pitch);

    // Crease lines on the pitch
    const creaseGeo = new THREE.PlaneGeometry(0.08, 5);
    const creaseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    [-2.5, 0, 2.5].forEach(x => {
      const crease = new THREE.Mesh(creaseGeo, creaseMat);
      crease.rotation.x = -Math.PI / 2;
      crease.position.set(x, -14.9, 0);
      scene.add(crease);
    });

    // ─── Mouse / touch tracking ───────────────────────────────────────────────
    const mouse    = { x: 0, y: 0 };
    const target   = { x: 0, y: 0 };
    const DAMPING  = 0.06;

    const onMouseMove = (e) => {
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect) return;
      mouse.x = ((e.clientX - rect.left) / rect.width  - 0.5) * 2;
      mouse.y = ((e.clientY - rect.top)  / rect.height - 0.5) * 2;
    };

    // Touch — single finger drag
    let lastTouch = null;
    const onTouchStart = (e) => { if (e.touches[0]) lastTouch = e.touches[0]; };
    const onTouchMove  = (e) => {
      if (!e.touches[0] || !mountRef.current) return;
      const rect = mountRef.current.getBoundingClientRect();
      mouse.x = ((e.touches[0].clientX - rect.left) / rect.width  - 0.5) * 2;
      mouse.y = ((e.touches[0].clientY - rect.top)  / rect.height - 0.5) * 2;
      lastTouch = e.touches[0];
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove',  onTouchMove,  { passive: true });

    // ─── Resize ───────────────────────────────────────────────────────────────
    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // ─── Animation loop ───────────────────────────────────────────────────────
    let animId;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Smooth mouse lag (damping)
      target.x += (mouse.x - target.x) * DAMPING;
      target.y += (mouse.y - target.y) * DAMPING;

      // Rotate the whole ball group with mouse
      ballGroup.rotation.y  = target.x * 0.5;
      ballGroup.rotation.x  = -target.y * 0.3;
      starMesh.rotation.y   = t * 0.008;

      // Float each ball individually
      balls.forEach(b => {
        const d = b.userData;
        b.position.y = d.origY + Math.sin(t * d.floatSpeed + d.floatPhase) * d.floatAmp;
        b.rotation.x += d.rotSpeedX;
        b.rotation.y += d.rotSpeedY;
      });

      // Pulse lights
      pointLight1.intensity = 2.5 + Math.sin(t * 1.1) * 0.7;
      pointLight2.intensity = 1.8 + Math.cos(t * 0.9) * 0.5;

      renderer.render(scene, camera);
    };
    animate();

    // ─── Cleanup ─────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove',  onTouchMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 480 }}>
      {/* Three.js canvas fills the entire area */}
      <div
        ref={mountRef}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Overlay text — centered */}
      <div style={{
        position        : 'absolute',
        inset           : 0,
        display         : 'flex',
        flexDirection   : 'column',
        alignItems      : 'center',
        justifyContent  : 'center',
        pointerEvents   : 'none',
        zIndex          : 1,
      }}>
        <div style={{
          fontFamily      : "'Rajdhani', 'Inter', sans-serif",
          fontSize        : 'clamp(28px, 5vw, 52px)',
          fontWeight      : 900,
          letterSpacing   : '2px',
          color           : '#f1f5f9',
          textShadow      : '0 0 30px rgba(99,102,241,.6), 0 2px 8px rgba(0,0,0,.8)',
          textAlign       : 'center',
          padding         : '0 20px',
          lineHeight      : 1.2,
        }}>
          {message}
        </div>
        <div style={{
          marginTop       : 16,
          fontSize        : 14,
          color           : '#475569',
          textShadow      : '0 1px 4px rgba(0,0,0,.8)',
          fontFamily      : "'Inter', sans-serif",
        }}>
          Move your mouse or drag to interact
        </div>
        <div style={{
          display         : 'flex',
          gap             : 8,
          marginTop       : 20,
        }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width     : 8, height: 8,
              borderRadius: '50%',
              background  : '#4f46e5',
              animation   : `pulse3d 1.4s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse3d {
          0%,100% { opacity: .3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}
