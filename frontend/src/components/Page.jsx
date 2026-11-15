import { motion } from 'motion/react';

// Wraps a screen's content so it eases in when the page opens. Honours the visitor's
// "reduce motion" setting (App.jsx wraps everything in <MotionConfig reducedMotion="user">).
export default function Page({ children, className = 'page' }) {
  return (
    <motion.main
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.main>
  );
}
