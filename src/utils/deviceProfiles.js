/**
 * Maps backend device security profiles (see `eventyay/api/auth/devicesecurity.py`) to the
 * station-type roles a signed-in user can pick in this app (see `STATION_TYPE_DEFINITIONS`
 * in `@/utils/session`). Used to warn users as soon as possible when the role they picked
 * does not match how the organizer configured the device, instead of only failing later
 * when a specific API call gets rejected.
 */

export const SECURITY_PROFILE_LABELS = {
  full: 'Full device access',
  eventyay_checkin: 'Check-In Staff',
  eventyay_checkin_online_kiosk: 'Badge Station (kiosk)'
}

// Roles allowed for each known security profile. A profile not listed here (including a
// missing/empty value from older devices) is treated as unrestricted, matching the backend's
// own fallback to full access for unrecognized profile identifiers.
const ALLOWED_ROLES_BY_PROFILE = {
  full: ['Exhibitor', 'CheckIn', 'Badge Station'],
  eventyay_checkin: ['CheckIn', 'Badge Station'],
  eventyay_checkin_online_kiosk: ['Badge Station']
}

// The role to suggest switching to when the current role isn't allowed for the profile.
const SUGGESTED_ROLE_BY_PROFILE = {
  eventyay_checkin: 'CheckIn',
  eventyay_checkin_online_kiosk: 'Badge Station'
}

export function isKnownSecurityProfile(securityProfile) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_ROLES_BY_PROFILE, securityProfile)
}

export function getSecurityProfileLabel(securityProfile) {
  return SECURITY_PROFILE_LABELS[securityProfile] || 'this device'
}

export function isRoleAllowedForProfile(role, securityProfile) {
  if (!role || !isKnownSecurityProfile(securityProfile)) {
    return true
  }
  return ALLOWED_ROLES_BY_PROFILE[securityProfile].includes(role)
}

export function getSuggestedRoleForProfile(securityProfile) {
  return SUGGESTED_ROLE_BY_PROFILE[securityProfile] || null
}

export function getAllowedRolesForProfile(securityProfile) {
  if (!isKnownSecurityProfile(securityProfile)) {
    return null
  }
  return ALLOWED_ROLES_BY_PROFILE[securityProfile]
}
