// Offscreen документът не може да покаже диалог за разрешение. Затова микрофонът
// се разрешава веднъж тук, на видима страница на разширението. След това
// разрешението важи за целия произход на разширението, включително offscreen.

const button = document.querySelector<HTMLButtonElement>("#grant")!;
const status = document.querySelector<HTMLElement>("#status")!;

button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    status.className = "ok";
    status.textContent = "Готово. Затворете този таб и включете Copilot отново от иконата в Meet.";
  } catch {
    button.disabled = false;
    status.className = "err";
    status.textContent =
      "Микрофонът не е разрешен. Разрешете го от иконата в адресната лента и опитайте отново.";
  }
});

export {};
