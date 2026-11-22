const menuToggle = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector("#primary-nav");
const contactForm = document.querySelector("#project-form");
const formStatus = document.querySelector("#form-status");
const currentYear = document.querySelector("#current-year");
const contactService = document.querySelector("#contact-service");
const scrollProgress = document.querySelector(".scroll-progress");
const adminEntry = document.querySelector(".admin-entry");

if (adminEntry && window.location.protocol === "file:") {
  adminEntry.href = "http://localhost:8001/admin";
}

currentYear.textContent = new Date().getFullYear();

const requestedService = new URLSearchParams(window.location.search).get("service");
if (requestedService && Array.from(contactService.options).some((option) => option.value === requestedService)) {
  contactService.value = requestedService;
  formStatus.textContent = `${requestedService} selected. Tell us a little more about your project.`;
}

const revealElements = document.querySelectorAll(
  ".hero-copy, .hero-art, .intro-band-inner > *, .section-heading > *, .service-card, .about-image-wrap, .about-copy, .values-top > *, .value-card, .brand-copy, .brand-card > img, .contact-text, .contact-form, .footer-main > *",
);

revealElements.forEach((element, index) => {
  element.classList.add("reveal");
  if (element.matches(".service-card, .value-card")) {
    element.style.setProperty("--reveal-delay", `${(index % 5) * 65}ms`);
  }
});

document.documentElement.classList.add("motion-ready");

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealElements.forEach((element) => revealObserver.observe(element));
} else {
  revealElements.forEach((element) => element.classList.add("is-visible"));
}

let progressFrame = 0;
const updateScrollProgress = () => {
  if (progressFrame) return;
  progressFrame = requestAnimationFrame(() => {
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollableHeight > 0 ? (window.scrollY / scrollableHeight) * 100 : 0;
    scrollProgress.style.width = `${Math.min(progress, 100)}%`;
    progressFrame = 0;
  });
};

window.addEventListener("scroll", updateScrollProgress, { passive: true });
window.addEventListener("resize", updateScrollProgress);
updateScrollProgress();

menuToggle.addEventListener("click", () => {
  const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isExpanded));
  primaryNav.classList.toggle("is-open", !isExpanded);
});

primaryNav.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    menuToggle.setAttribute("aria-expanded", "false");
    primaryNav.classList.remove("is-open");
  }
});

document.querySelectorAll(".service-action").forEach((button) => {
  button.addEventListener("click", () => {
    const service = button.dataset.service;
    contactService.value = service;
    document.querySelectorAll(".service-card.is-selected").forEach((card) => {
      card.classList.remove("is-selected");
    });
    button.closest(".service-card").classList.add("is-selected");
    formStatus.textContent = `${service} selected. Add a few details and prepare your inquiry.`;
    document.querySelector("#contact").scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => document.querySelector("#contact-name").focus({ preventScroll: true }), 500);
  });
});

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!contactForm.reportValidity()) return;

  const formData = new FormData(contactForm);
  const name = formData.get("name").trim();
  const email = formData.get("email").trim();
  const phone = formData.get("phone").trim();
  const message = formData.get("message").trim();
  const service = formData.get("service");
  const subject = encodeURIComponent(`Bara Studios project enquiry from ${name}`);
  const serviceLine = service ? `I’m interested in: ${service}\n` : "";
  const phoneLine = phone ? `\nPhone: ${phone}` : "";
  const body = encodeURIComponent(`Hi Bara Studios,\n\n${serviceLine}${message}\n\nMy name is ${name}.\nYou can reach me at ${email}.${phoneLine}`);

  const submitButton = contactForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  formStatus.textContent = "Sending your inquiry securely…";
  try {
    const response = await fetch("/api/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData)),
      credentials: "same-origin",
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The enquiry service returned an error.");
    contactForm.reset();
    formStatus.textContent = "Thank you. Your inquiry has been sent to Bara Studios.";
  } catch (error) {
    console.error("Online enquiry submission failed.", error);
    formStatus.textContent = "The online enquiry inbox is unavailable. Opening an email draft instead.";
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  } finally {
    submitButton.disabled = false;
  }
});
