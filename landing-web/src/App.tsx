import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Marquee from "./components/Marquee";
import Problem from "./components/Problem";
import HowItWorks from "./components/HowItWorks";
import ChatDemo from "./components/ChatDemo";
import ProductShowcase from "./components/ProductShowcase";
import Features from "./components/Features";
import WhyUs from "./components/WhyUs";
import Pricing from "./components/Pricing";
import Testimonials from "./components/Testimonials";
import Faq from "./components/Faq";
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
        <HowItWorks />
        <ChatDemo />
        <ProductShowcase />
        <Features />
        <WhyUs />
        <Pricing />
        <Testimonials />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <WhatsappFloat />
    </div>
  );
}
