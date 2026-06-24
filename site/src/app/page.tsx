import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';
import { Stats } from '@/components/Stats';
import { Features } from '@/components/Features';
import { Demo } from '@/components/Demo';
import { Screenshots } from '@/components/Screenshots';
import { Comparison } from '@/components/Comparison';
import { Pricing } from '@/components/Pricing';
import { Download } from '@/components/Download';
import { CTA } from '@/components/CTA';
import { Footer } from '@/components/Footer';

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Stats />
        <Features />
        <Demo />
        <Screenshots />
        <Comparison />
        <Pricing />
        <Download />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
