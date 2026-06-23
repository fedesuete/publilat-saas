import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import WhyUs from "./components/WhyUs";
import Pricing from "./components/Pricing";
import Testimonials from "./components/Testimonials";
import FinalCta from "./components/FinalCta";
import Footer from "./components/Footer";
import WhatsappFloat from "./components/WhatsappFloat";

export default function App() {
  return (
    <div className="relative overflow-x-hidden">
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <WhyUs />
        <Pricing />
        <Testimonials />
        <FinalCta />
      </main>
      <Footer />
      <WhatsappFloat />
    </div>
  );
}
