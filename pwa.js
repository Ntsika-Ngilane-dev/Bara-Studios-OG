const installNavigation = document.querySelector(".primary-nav");
let installPrompt;

if (installNavigation) {
  const installButton = document.createElement("button");
  installButton.className = "install-app";
  installButton.type = "button";
  installButton.textContent = "Install app";
  installButton.hidden = true;
  installNavigation.append(installButton);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;

    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
  });
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.error("Bara Studios service worker registration failed.", error);
  });
}
