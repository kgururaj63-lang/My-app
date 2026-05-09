import React, { useEffect, useRef } from 'react';

export const NetworkNodes: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Particle[] = [];
    const particleCount = 25;

    class Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;

      constructor(w: number, h: number) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.vx = (Math.random() - 0.5) * 0.4;
        this.vy = (Math.random() - 0.5) * 0.4;
        this.size = 1.5;
      }

      update(w: number, h: number, dt: number = 1) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        if (this.x < 0) {
          this.x = 0;
          this.vx *= -1;
        } else if (this.x > w) {
          this.x = w;
          this.vx *= -1;
        }

        if (this.y < 0) {
          this.y = 0;
          this.vy *= -1;
        } else if (this.y > h) {
          this.y = h;
          this.vy *= -1;
        }
      }

      draw() {
        if (!ctx) return;
        ctx.fillStyle = 'rgba(6, 108, 244, 0.4)';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const init = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      
      const count = width < 768 ? 15 : 25;
      particles = [];
      for (let i = 0; i < count; i++) {
        particles.push(new Particle(width, height));
      }
    };

    const drawLines = () => {
      const width = canvas.width;
      const height = canvas.height;
      const length = particles.length;

      for (let i = 0; i < length; i++) {
        const p1 = particles[i];
        for (let j = i + 1; j < length; j++) {
          const p2 = particles[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < 22500) { // 150 * 150
            const distance = Math.sqrt(distSq);
            ctx.strokeStyle = `rgba(6, 108, 244, ${0.15 * (1 - distance / 150)})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
    };

    let lastTime = 0;
    const animate = (time: number) => {
      const width = canvas.width;
      const height = canvas.height;
      
      // Calculate delta time
      const dt = lastTime ? (time - lastTime) / 16.67 : 1; // Normalized to 60fps
      lastTime = time;

      ctx.clearRect(0, 0, width, height);
      
      particles.forEach(p => {
        p.update(width, height, dt);
        p.draw();
      });
      drawLines();
      animationFrameId = requestAnimationFrame(animate);
    };

    init();
    requestAnimationFrame(animate);

    const handleResize = () => {
      init();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none opacity-20 z-0"
    />
  );
};
