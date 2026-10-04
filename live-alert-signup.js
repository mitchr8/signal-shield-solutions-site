(() => {
  const form = document.getElementById('liveAlertSignup');
  if(!form) return;
  const message = form.querySelector('[role="status"]');
  const button = form.querySelector('button[type="submit"]');
  function showMessage(text, state){
    message.textContent = text;
    message.dataset.state = state;
    message.hidden = false;
  }
  if(new URLSearchParams(location.search).get('alerts') === 'confirmed'){
    showMessage('Email confirmed — you’re on the list! We’ll email you when a new print goes live.', 'success');
  }
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if(!form.reportValidity()) return;
    button.disabled = true;
    showMessage('Sending your confirmation email…', 'pending');
    try{
      const response = await fetch('/print-alerts/subscribe',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:form.elements.email.value,consent:form.elements.consent.checked,
          website:form.elements.website.value}),signal:AbortSignal.timeout(15000)
      });
      const result = await response.json();
      if(response.ok){
        showMessage('One more step: check your inbox! Open “Confirm your live-print alerts” and click “Confirm my email.” Alerts won’t start until you confirm. If it’s missing, check Spam or Promotions.', 'success');
        form.reset();
      }else{
        showMessage(result.message || 'Please try again in a moment.', 'error');
      }
      message.focus({preventScroll:true});
      message.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch{showMessage('We couldn’t reach the signup service. Please try again.', 'error');}
    finally{button.disabled = false;}
  });
})();
