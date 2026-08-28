export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    const key = part.slice(0, separator).trim();
    let value = part.slice(separator + 1).trim();
    try { value = decodeURIComponent(value); } catch { value = ''; }
    return [key, value];
  }).filter(([key]) => key));
}

export function privateCookieOptions(request, maxAge) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: Boolean(request.secure),
    maxAge,
    path: '/',
  };
}
