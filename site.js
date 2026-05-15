(function(){
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const topBar = document.getElementById("topBar");
  if(topBar){
    const syncTopBar = () => topBar.classList.toggle("scrolled", window.scrollY > 10);
    syncTopBar();
    window.addEventListener("scroll", syncTopBar, { passive: true });
  }

  const revealNodes = document.querySelectorAll(".reveal");
  if(revealNodes.length){
    if(prefersReducedMotion || !("IntersectionObserver" in window)){
      revealNodes.forEach((node) => node.classList.add("visible"));
    }else{
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if(entry.isIntersecting){
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      revealNodes.forEach((node) => observer.observe(node));
    }
  }

  if(!prefersReducedMotion){
    document.querySelectorAll("[data-tilt]").forEach((panel) => {
      const resetTilt = () => {
        panel.style.setProperty("--tilt-x", "0deg");
        panel.style.setProperty("--tilt-y", "0deg");
        panel.style.setProperty("--glow-x", "50%");
        panel.style.setProperty("--glow-y", "46%");
      };

      resetTilt();

      panel.addEventListener("pointermove", (event) => {
        const rect = panel.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width;
        const py = (event.clientY - rect.top) / rect.height;
        const tiltX = ((px - 0.5) * 6).toFixed(2) + "deg";
        const tiltY = ((0.5 - py) * 6).toFixed(2) + "deg";
        panel.style.setProperty("--tilt-x", tiltX);
        panel.style.setProperty("--tilt-y", tiltY);
        panel.style.setProperty("--glow-x", (px * 100).toFixed(1) + "%");
        panel.style.setProperty("--glow-y", (py * 100).toFixed(1) + "%");
      });

      panel.addEventListener("pointerleave", resetTilt);
      panel.addEventListener("pointercancel", resetTilt);
    });
  }

  initFormShells();
  initChat();

  function isValidEmail(value){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function submitFormSubmit(payload){
    const response = await fetch("https://formsubmit.co/ajax/contracts@signalshieldsolutions.com", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: payload.toString()
    });

    if(!response.ok){
      throw new Error("send failed");
    }

    return response.json().catch(() => ({}));
  }

  function prettifyFieldName(name){
    return String(name || "")
      .replace(/^_+/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function buildMailtoHref(subject, body){
    return "mailto:contracts@signalshieldsolutions.com?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  async function copyToClipboard(text){
    if(navigator.clipboard && typeof navigator.clipboard.writeText === "function"){
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  }

  function createFallbackBody(formData){
    const lines = [];
    for(const [key, value] of formData.entries()){
      if(String(key).startsWith("_")){
        continue;
      }
      if(value == null || String(value).trim() === ""){
        continue;
      }
      lines.push(prettifyFieldName(key) + ": " + String(value).trim());
    }
    return lines.join("\n");
  }

  function setFormResponse(responseNode, tone, content){
    responseNode.className = "form-response " + tone;
    responseNode.innerHTML = "";
    if(typeof content === "string"){
      responseNode.textContent = content;
    }else if(content){
      responseNode.appendChild(content);
    }
  }

  function initFormShells(){
    const forms = document.querySelectorAll(".form-shell[action*='formsubmit.co']");
    forms.forEach((form) => {
      if(form.dataset.ajaxBound === "true"){
        return;
      }
      form.dataset.ajaxBound = "true";

      const submitButton = form.querySelector("button[type='submit'], input[type='submit']");
      if(!submitButton){
        return;
      }

      let responseNode = form.querySelector("[data-form-response]");
      if(!responseNode){
        responseNode = document.createElement("div");
        responseNode.className = "form-response";
        responseNode.setAttribute("data-form-response", "");
        responseNode.setAttribute("aria-live", "polite");
        form.appendChild(responseNode);
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const payload = new URLSearchParams();

        for(const [key, value] of formData.entries()){
          if(typeof value === "string"){
            payload.append(key, value);
          }
        }

        if(payload.has("_captcha")){
          payload.set("_captcha", "false");
        }else{
          payload.append("_captcha", "false");
        }

        const emailValue = (formData.get("email") || "").toString().trim();
        if(emailValue && !payload.has("_replyto")){
          payload.append("_replyto", emailValue);
        }

        const subject = (formData.get("_subject") || "Website inquiry").toString().trim();
        const fallbackBody = createFallbackBody(formData);
        const originalLabel = submitButton.tagName === "INPUT" ? submitButton.value : submitButton.textContent;

        submitButton.disabled = true;
        if(submitButton.tagName === "INPUT"){
          submitButton.value = "Sending...";
        }else{
          submitButton.textContent = "Sending...";
        }
        setFormResponse(responseNode, "pending", "Sending your message now.");

        try{
          await submitFormSubmit(payload);
          form.reset();
          setFormResponse(responseNode, "success", "Thanks. Your message is on the way.");
        }catch(error){
          const wrapper = document.createElement("div");
          const message = document.createElement("p");
          message.textContent = "Automatic sending is unavailable right now. Use the fallback options below so the message is still ready to send.";
          wrapper.appendChild(message);

          const actions = document.createElement("div");
          actions.className = "form-fallback-actions";

          const emailButton = document.createElement("button");
          emailButton.type = "button";
          emailButton.className = "btn secondary mini-button";
          emailButton.textContent = "Open email draft";
          emailButton.addEventListener("click", () => {
            window.location.href = buildMailtoHref(subject, fallbackBody);
          });
          actions.appendChild(emailButton);

          const copyButton = document.createElement("button");
          copyButton.type = "button";
          copyButton.className = "btn secondary mini-button";
          copyButton.textContent = "Copy message";
          copyButton.addEventListener("click", async () => {
            const copied = await copyToClipboard("Subject: " + subject + "\n\n" + fallbackBody).catch(() => false);
            copyButton.textContent = copied ? "Copied" : "Copy failed";
          });
          actions.appendChild(copyButton);

          wrapper.appendChild(actions);
          setFormResponse(responseNode, "error", wrapper);
        }finally{
          submitButton.disabled = false;
          if(submitButton.tagName === "INPUT"){
            submitButton.value = originalLabel;
          }else{
            submitButton.textContent = originalLabel;
          }
        }
      });
    });
  }

  function initChat(){
    const chatBtn = document.getElementById("chatBtn");
    const chatPanel = document.getElementById("chatPanel");
    const chatClose = document.getElementById("chatClose");
    const chatMessages = document.getElementById("chatMessages");
    const chatChoices = document.getElementById("chatChoices");
    const chatForm = document.getElementById("chatForm");
    const chatInput = document.getElementById("chatInput");
    const chatSend = chatForm ? chatForm.querySelector("button") : null;

    if(!chatBtn || !chatPanel || !chatClose || !chatMessages || !chatChoices || !chatForm || !chatInput || !chatSend){
      return;
    }

    const config = window.CHAT_CONFIG || {};
    const state = {
      started: false,
      step: "service",
      sending: false,
      data: {
        page: config.page || document.title,
        url: window.location.href
      }
    };

    function addMessage(role, text){
      const bubble = document.createElement("div");
      bubble.className = "chat-bubble " + role;
      bubble.textContent = text;
      chatMessages.appendChild(bubble);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function setChoices(items){
      chatChoices.innerHTML = "";
      (items || []).forEach((item) => {
        const label = typeof item === "string" ? item : item.label;
        const value = typeof item === "string" ? item : item.value;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chat-chip";
        chip.textContent = label;
        chip.addEventListener("click", () => handleInput(value, label));
        chatChoices.appendChild(chip);
      });
    }

    function setOpen(open){
      chatPanel.classList.toggle("open", open);
      chatPanel.setAttribute("aria-hidden", String(!open));
      chatBtn.setAttribute("aria-expanded", String(open));
      if(open){
        if(!state.started){
          startChat();
        }
        window.setTimeout(() => chatInput.focus(), 40);
      }
    }

    function startChat(){
      state.started = true;
      addMessage("bot", config.welcome || "Welcome.");
      addMessage("bot", config.prompt || "How can we help?");
      setChoices(config.choices || []);
      chatInput.placeholder = "Choose an option or type your answer";
    }

    function resetChat(){
      chatMessages.innerHTML = "";
      chatChoices.innerHTML = "";
      chatInput.disabled = false;
      chatSend.disabled = false;
      chatInput.value = "";
      state.started = false;
      state.step = "service";
      state.sending = false;
      state.data = {
        page: config.page || document.title,
        url: window.location.href
      };
      startChat();
    }

    async function submitLead(){
      state.sending = true;
      chatInput.disabled = true;
      chatSend.disabled = true;
      setChoices([]);
      addMessage("bot", "Sending this to our team now.");

      const payload = new URLSearchParams({
        name: state.data.name,
        email: state.data.email,
        _replyto: state.data.email,
        _subject: config.subject || "Website inquiry",
        _captcha: "false",
        service: state.data.service || "General",
        page: state.data.page,
        message:
          "Service: " + (state.data.service || "General") + "\n" +
          "Page: " + state.data.page + "\n" +
          "URL: " + state.data.url + "\n" +
          "Name: " + state.data.name + "\n" +
          "Email: " + state.data.email + "\n" +
          "Details: " + state.data.details
      });

      try{
        await submitFormSubmit(payload);
        addMessage("bot", "Thanks, " + state.data.name + ". Your message is on the way, and we will reply at " + state.data.email + ".");
        state.step = "done";
        setChoices([{ label: "Start a new chat", value: "__reset__" }]);
      }catch(error){
        addMessage("bot", "Automatic sending is unavailable right now. You can still use the email link below or try again later.");
        state.step = "confirm";
        chatInput.disabled = false;
        chatSend.disabled = false;
        setChoices([
          { label: "Try again", value: "__send__" },
          { label: "Start over", value: "__reset__" }
        ]);
      }finally{
        state.sending = false;
      }
    }

    function handleInput(rawValue, label){
      const value = (rawValue || "").trim();
      if(!value || state.sending){
        return;
      }

      if(value === "__reset__"){
        resetChat();
        return;
      }

      if(value === "__send__"){
        addMessage("user", label || "Send it");
        submitLead();
        return;
      }

      addMessage("user", label || value);

      if(state.step === "service"){
        state.data.service = value;
        state.step = "name";
        setChoices([]);
        chatInput.value = "";
        chatInput.placeholder = "Your name";
        addMessage("bot", "Got it. What should we call you?");
        return;
      }

      if(state.step === "name"){
        state.data.name = value;
        state.step = "email";
        chatInput.value = "";
        chatInput.placeholder = "name@example.com";
        addMessage("bot", "Thanks, " + value.split(" ")[0] + ". What email should we reply to?");
        return;
      }

      if(state.step === "email"){
        if(!isValidEmail(value)){
          chatInput.value = "";
          addMessage("bot", "Please enter a valid email address so we can reply.");
          return;
        }

        state.data.email = value;
        state.step = "details";
        chatInput.value = "";
        chatInput.placeholder = config.detailsPlaceholder || "Share the details";
        addMessage("bot", config.detailsPrompt || "Share a short summary so our team has the right context.");
        return;
      }

      if(state.step === "details"){
        state.data.details = value;
        state.step = "confirm";
        chatInput.value = "";
        chatInput.placeholder = "Add anything else or choose Send it";
        addMessage("bot", "I have what I need. Send this to the team?");
        setChoices([
          { label: "Send it", value: "__send__" },
          { label: "Start over", value: "__reset__" }
        ]);
        return;
      }

      if(state.step === "confirm"){
        state.data.details += "\nAdditional note: " + value;
        chatInput.value = "";
        addMessage("bot", "Added that. Send it when you are ready.");
        setChoices([
          { label: "Send it", value: "__send__" },
          { label: "Start over", value: "__reset__" }
        ]);
        return;
      }

      if(state.step === "done"){
        resetChat();
      }
    }

    chatBtn.addEventListener("click", () => setOpen(!chatPanel.classList.contains("open")));
    chatClose.addEventListener("click", () => setOpen(false));
    chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleInput(chatInput.value);
    });

    document.addEventListener("keydown", (event) => {
      if(event.key === "Escape"){
        setOpen(false);
      }
    });

    document.addEventListener("click", (event) => {
      if(!chatPanel.classList.contains("open")){
        return;
      }
      if(chatPanel.contains(event.target) || chatBtn.contains(event.target)){
        return;
      }
      setOpen(false);
    });
  }
})();
