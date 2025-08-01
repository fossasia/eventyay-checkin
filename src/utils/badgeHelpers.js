/**
 * Shared utility functions for badge download and response parsing
 */

/**
 * Extracts badge download URL from API response
 * @param {Object} response - API response object
 * @returns {string|null} - Badge download URL or null if not found
 */
export const extractBadgeUrl = (response) => {
  if (!response?.position?.downloads) {
    return null
  }
  
  const badgeDownload = response.position.downloads.find(
    (download) => download.output === 'badge'
  )
  
  return badgeDownload?.url || null
}

/**
 * Extracts attendee name from API response
 * @param {Object} response - API response object
 * @returns {string} - Attendee name or default value
 */
export const extractAttendeeName = (response) => {
  return response?.position?.attendee_name || 'Unknown Attendee'
}

/**
 * Processes check-in/check-out response and returns standardized result
 * @param {Object} response - API response object
 * @param {boolean} isCheckoutMode - Whether in checkout mode
 * @returns {Object} - Processed response with status, message, attendeeName, and badgeUrl
 */
export const processCheckInResponse = (response, isCheckoutMode) => {
  if (!response) {
    const operation = isCheckoutMode ? 'Check-out' : 'Check-in'
    return {
      success: false,
      message: `${operation} failed! No response received.`,
      attendeeName: 'Unknown Attendee',
      badgeUrl: null
    }
  }

  const attendeeName = extractAttendeeName(response)
  const badgeUrl = extractBadgeUrl(response)
  
  switch (response.status) {
    case 'ok':
      const successMessage = isCheckoutMode ? 'Check-out successful!' : 'Check-in successful!'
      return {
        success: true,
        message: successMessage,
        attendeeName,
        badgeUrl
      }
      
    case 'redeemed':
      const alreadyMessage = isCheckoutMode ? 'Already Checked-out!' : 'Already Checked-in!'
      return {
        success: true,
        message: alreadyMessage,
        attendeeName,
        badgeUrl
      }
      
    case 'cancelled':
      return {
        success: false,
        message: 'Ticket has been cancelled!',
        attendeeName,
        badgeUrl: null
      }
      
    case 'already_redeemed':
      return {
        success: false,
        message: 'Ticket already redeemed!',
        attendeeName,
        badgeUrl: null
      }
      
    default:
      const operation = isCheckoutMode ? 'Check-out' : 'Check-in'
      return {
        success: false,
        message: `${operation} failed! Status: ${response.status || 'Unknown'}`,
        attendeeName,
        badgeUrl: null
      }
  }
}