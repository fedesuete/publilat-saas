import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Marquee from "./components/Marquee";
import Problem from "./components/Problem";
import Features from "./components/Features";
import ProductShowcase from "./components/ProductShowcase";
import HowItWorks from "./components/HowItWorks";
import ChatDemo from "./components/ChatDemo";
import Testimonials from "./components/Testimonials";
import Roadmap from "./components/Roadmap";
import Faq from "./components/Faq";
import Pricing from "./components/Pricing";
import FinalCta from "./components/FinalCta";
import Footer from "./components/Footer";
import WhatsappFloat from "./components/WhatsappFloat";

export default function App() {
  return (
    <div className="relative overflow-x-hidden">
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Problem />
        <Features />
        <ProductShowcase />
        <HowItWorks />
        <ChatDemo />
        <Testimonials />
        <Roadmap />
        <Faq />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
      <WhatsappFloat />
    </div>
  );
}
