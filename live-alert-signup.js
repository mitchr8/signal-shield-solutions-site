(() => {
  const form = document.getElementById('liveAlertSignup');
  if(!form) return;
  const message = form.querySelector('[role="status"]');
  const button = form.querySelector('button[type="submit"]');
  if(new URLSearchParams(location.search).get('alerts') === 'confirmed'){
    message.textContent = 'Thanks for confirming! You’re on the list for future live prints.';
  }
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if(!form.reportValidity()) return;
    button.disabled = true;
    message.textContent = 'Sending your confirmation email…';
    try{
      const response = await fetch('/print-alerts/subscribe',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:form.elements.email.value,consent:form.elements.consent.checked,
          website:form.elements.website.value}),signal:AbortSignal.timeout(15000)
      });
      const result = await response.json();
      message.textContent = result.message || 'Please try again in a moment.';
      if(response.ok) form.reset();
    }catch{message.textContent = 'We couldn’t reach the signup service. Please try again.';}
    finally{button.disabled = false;}
  });
})();
