
import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  color: string;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, color }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    if (!isActive) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationFrame: number;
    const bars = 20;
    const values = Array(bars).fill(0);
    
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = canvas.width / bars;
      
      for (let i = 0; i < bars; i++) {
        // Randomly simulate voice activity when active
        values[i] = Math.max(2, Math.random() * (isActive ? canvas.height : 5));
        
        ctx.fillStyle = color;
        const x = i * barWidth;
        const y = (canvas.height - values[i]) / 2;
        
        // Rounded rectangles
        const radius = barWidth / 3;
        ctx.beginPath();
        ctx.roundRect(x + 2, y, barWidth - 4, values[i], radius);
        ctx.fill();
      }
      
      animationFrame = requestAnimationFrame(render);
    };
    
    render();
    
    return () => cancelAnimationFrame(animationFrame);
  }, [isActive, color]);

  return (
    <canvas 
      ref={canvasRef} 
      width={120} 
      height={40} 
      className="opacity-80"
    />
  );
};

export default Visualizer;
