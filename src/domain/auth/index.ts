export {
  hashPhone,
  normalisePhone,
  phoneHashMatches,
  type PhoneParseFailure,
  type PhoneParseResult,
} from './phone'

export {
  MAX_OTP_ATTEMPTS,
  OTP_LENGTH,
  OTP_TTL_MS,
  generateOtpCode,
  hashOtpCode,
  otpChallengeStatus,
  otpCodeMatches,
  otpExpiresAt,
  type OtpChallengeState,
  type OtpChallengeStatus,
} from './otp'

export {
  MAX_OTP_PER_IP_PER_WINDOW,
  MAX_OTP_PER_NUMBER_PER_WINDOW,
  RATE_LIMIT_WINDOW_MS,
  checkOtpRateLimit,
  rateLimitWindowStart,
  type OtpRequestCounts,
  type RateLimitDecision,
} from './rate-limit'

export {
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
  pendingCookieName,
  sessionCookieName,
  sessionCookieOptions,
  sessionExpiresAt,
  sessionStatus,
  sessionTokenMatches,
  type SessionCookieOptions,
  type SessionState,
  type SessionStatus,
} from './session'
