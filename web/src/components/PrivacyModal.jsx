import { useEffect, useRef } from 'react';

export default function PrivacyModal({ open, onClose }) {
  const dialog = useRef(null);

  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [open]);

  return (
    <dialog
      className="sheet"
      ref={dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      style={{ width: 'min(92vw, 42rem)', padding: '1.75rem 2rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0 }}>Privacy Policy</h2>
        <button 
          onClick={onClose} 
          type="button"
          style={{ background: 'none', border: 'none', color: 'var(--ink-faint)', fontSize: '1.75rem', cursor: 'pointer', padding: '0 0.5rem', lineHeight: 1 }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      
      <div className="notice" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '100%' }}>
        <p><strong>Letters in the Ocean collects no personal data.</strong></p>
        <p>This is a quiet place. We do not ask for your name, email, or identity. There are no accounts, no trackers, and no advertisements.</p>
        <p><strong>What we do collect:</strong></p>
        <ul style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <li><strong>Your letters:</strong> The text you write and release into the ocean is saved in our database so that others can find it. Do not include personal information in your letters.</li>
          <li><strong>An anonymous cookie:</strong> We set a single, secure session cookie on your browser. This cookie contains a random, anonymous ID. We use this solely to enforce the "one bottle a day" rule.</li>
          <li><strong>IP Addresses:</strong> Our infrastructure provider (Cloudflare) temporarily processes visitor IP addresses to protect the site from spam and abuse. We do not permanently store or analyze this data.</li>
        </ul>
      </div>
    </dialog>
  );
}
