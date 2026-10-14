(function() {
  function ensureModal() {
    let modal = document.getElementById('global-contact-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'global-contact-modal';
    modal.className = 'fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 hidden';
    modal.innerHTML = `
      <div class="bg-zinc-900 border border-zinc-700 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden font-sans text-zinc-100 flex flex-col max-h-[90vh]">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60 shrink-0">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div>
              <h3 class="font-bold text-sm text-white">Hubungi Admin Xiroro Script</h3>
              <p class="text-[11px] text-zinc-400">Kirimkan pertanyaan, laporan link, atau pengaduan DMCA</p>
            </div>
          </div>
          <button type="button" id="contact-modal-close" class="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Body Form -->
        <form id="contact-modal-form" class="p-6 space-y-4 overflow-y-auto font-mono text-xs">
          <div id="contact-alert" class="hidden p-3 rounded text-xs"></div>

          <div>
            <label class="block text-zinc-300 font-bold mb-1">Nama Lengkap *</label>
            <input type="text" id="contact-input-name" required maxlength="80" placeholder="Contoh: Budi Santoso" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-zinc-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition">
          </div>

          <div>
            <label class="block text-zinc-300 font-bold mb-1">Alamat Email Anda *</label>
            <input type="email" id="contact-input-email" required maxlength="100" placeholder="nama@gmail.com" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-zinc-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition">
            <p class="text-[10px] text-zinc-500 mt-1">Admin dapat membalas pesan Anda ke alamat email ini.</p>
          </div>

          <div>
            <label class="block text-zinc-300 font-bold mb-1">Kategori / Subjek *</label>
            <select id="contact-input-subject" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-zinc-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition">
              <option value="Pertanyaan Umum">Pertanyaan Umum</option>
              <option value="Pengaduan DMCA / Hak Cipta">Pengaduan DMCA / Hak Cipta</option>
              <option value="Laporan Link Rusak / Error">Laporan Link Rusak / Error</option>
              <option value="Pertanyaan Privasi & Kebijakan">Pertanyaan Privasi & Kebijakan</option>
              <option value="Kerjasama Iklan & Bisnis">Kerjasama Iklan & Bisnis</option>
              <option value="Lainnya">Lainnya</option>
            </select>
          </div>

          <div>
            <label class="block text-zinc-300 font-bold mb-1">Isi Pesan *</label>
            <textarea id="contact-input-message" required rows="4" maxlength="3000" placeholder="Tuliskan pesan, URL link yang bermasalah, atau detail laporan Anda di sini..." class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-zinc-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition resize-none"></textarea>
          </div>

          <div class="pt-2 border-t border-zinc-800 flex items-center justify-end gap-3 shrink-0">
            <button type="button" id="contact-btn-cancel" class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition font-bold">Batal</button>
            <button type="submit" id="contact-btn-submit" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition flex items-center gap-2 shadow-lg shadow-emerald-950/50">
              <span id="contact-submit-text">Kirim Pesan</span>
              <svg id="contact-submit-spinner" class="w-4 h-4 animate-spin hidden" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = document.getElementById('contact-modal-close');
    const cancelBtn = document.getElementById('contact-btn-cancel');
    const closeModal = () => modal.classList.add('hidden');

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    const form = document.getElementById('contact-modal-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const alertBox = document.getElementById('contact-alert');
      const submitBtn = document.getElementById('contact-btn-submit');
      const submitText = document.getElementById('contact-submit-text');
      const submitSpinner = document.getElementById('contact-submit-spinner');

      const name = document.getElementById('contact-input-name').value.trim();
      const email = document.getElementById('contact-input-email').value.trim();
      const subject = document.getElementById('contact-input-subject').value;
      const message = document.getElementById('contact-input-message').value.trim();

      alertBox.className = 'hidden';
      submitBtn.disabled = true;
      submitSpinner.classList.remove('hidden');
      submitText.textContent = 'Mengirim...';

      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, subject, message }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.error || 'Gagal mengirim pesan.');
        }

        alertBox.className = 'p-3 rounded text-xs bg-emerald-950/80 border border-emerald-700 text-emerald-200 block';
        alertBox.textContent = '✓ ' + (data.message || 'Pesan Anda berhasil terkirim ke Admin!');
        form.reset();

        setTimeout(() => {
          closeModal();
          alertBox.className = 'hidden';
        }, 2200);
      } catch (err) {
        alertBox.className = 'p-3 rounded text-xs bg-red-950/80 border border-red-700 text-red-200 block';
        alertBox.textContent = '✕ ' + err.message;
      } finally {
        submitBtn.disabled = false;
        submitSpinner.classList.add('hidden');
        submitText.textContent = 'Kirim Pesan';
      }
    };

    return modal;
  }

  window.openContactModal = function(preferredSubject) {
    const modal = ensureModal();
    const alertBox = document.getElementById('contact-alert');
    if (alertBox) alertBox.className = 'hidden';

    if (preferredSubject) {
      const subjectSelect = document.getElementById('contact-input-subject');
      if (subjectSelect) {
        let found = false;
        for (let i = 0; i < subjectSelect.options.length; i++) {
          if (subjectSelect.options[i].value.toLowerCase().includes(preferredSubject.toLowerCase())) {
            subjectSelect.selectedIndex = i;
            found = true;
            break;
          }
        }
        if (!found) {
          subjectSelect.value = 'Lainnya';
        }
      }
    }

    modal.classList.remove('hidden');
  };
})();
