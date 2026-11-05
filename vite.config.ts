import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on GitHub Pages under /sapphire/.
export default defineConfig({ plugins: [react()], base: './' });
