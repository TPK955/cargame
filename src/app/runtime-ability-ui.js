function setAbilitySlot(slot, iconEl, badgeEl, heldAbility) {
  if (!slot || !iconEl || !badgeEl) {
    return;
  }

  if (heldAbility && heldAbility.charges > 0) {
    slot.dataset.empty = 'false';
    if (heldAbility.type === 'shield') {
      iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2L4 5v6c0 5.6 3.8 9.9 8 11 4.2-1.1 8-5.4 8-11V5l-8-3zm0 2.2l6 2.2V11c0 4.4-2.8 8.1-6 9.2-3.2-1.1-6-4.8-6-9.2V6.4l6-2.2z"/></svg>';
      slot.dataset.ability = 'shield';
    } else if (heldAbility.type === 'ghost') {
      iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3c-4.1 0-7 3-7 7.2V21l3-2.1L12 21l4-2.1 3 2.1V10.2C19 6 16.1 3 12 3zm3.8 12.2c-.7 0-1.3-.6-1.3-1.3s.6-1.3 1.3-1.3 1.3.6 1.3 1.3-.6 1.3-1.3 1.3zm-7.6 0c-.7 0-1.3-.6-1.3-1.3s.6-1.3 1.3-1.3 1.3.6 1.3 1.3-.6 1.3-1.3 1.3zm1 2.5c.8-.9 1.7-1.3 2.8-1.3s2 .4 2.8 1.3l.7-.6c-.9-1.2-2.1-1.8-3.5-1.8s-2.6.6-3.5 1.8l.7.6z"/></svg>';
      slot.dataset.ability = 'ghost';
    } else if (heldAbility.type === 'icebomb') {
      iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="13.5" r="6.5" fill="currentColor"/><path d="M10.5 6.8 13 4.3l2.7 2.7-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 3.2v2.2M17.4 4.3h2.2M17.9 3.7l1.2 1.2M17.9 4.9l1.2-1.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.8 11.2h7.6M6.8 13.6h7.6M6.8 16h7.6" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.9" stroke-linecap="round"/></svg>';
      slot.dataset.ability = 'icebomb';
    } else if (heldAbility.type === 'bomb') {
      iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="13.5" r="6.5" fill="currentColor"/><path d="M10.5 6.8 13 4.3l2.7 2.7-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.9 3.5h1.2M17.5 2.9v1.2M16.2 2.2l.8.8M16.2 4.8l.8-.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8.6" cy="11.4" r="1.2" fill="rgba(255,255,255,0.35)"/></svg>';
      slot.dataset.ability = 'bomb';
    } else {
      iconEl.textContent = '?';
      slot.dataset.ability = heldAbility.type;
    }

    if (heldAbility.charges > 1) {
      badgeEl.textContent = String(heldAbility.charges);
      badgeEl.style.display = 'inline-flex';
    } else {
      badgeEl.textContent = '';
      badgeEl.style.display = 'none';
    }
    return;
  }

  slot.dataset.empty = 'true';
  slot.dataset.ability = 'none';
  iconEl.textContent = '';
  iconEl.innerHTML = '';
  badgeEl.textContent = '';
  badgeEl.style.display = 'none';
}

export function updateHeldAbilitySlots(localPlayer, elements) {
  const { abilitySlotLeft, abilitySlotLeftIcon, abilitySlotLeftBadge, abilitySlotRight, abilitySlotRightIcon, abilitySlotRightBadge } = elements;
  const heldAbilities = Array.isArray(localPlayer?.heldAbilities) ? localPlayer.heldAbilities : [];
  setAbilitySlot(abilitySlotLeft, abilitySlotLeftIcon, abilitySlotLeftBadge, heldAbilities[0] ?? null);
  setAbilitySlot(abilitySlotRight, abilitySlotRightIcon, abilitySlotRightBadge, heldAbilities[1] ?? null);
}
