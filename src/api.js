export async function request(action, body, page) {
  let response;
  try {
    response = await fetch(`/api/index?action=${action}${page ? `&page=${page}` : ''}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new Error(
      'No se pudo confirmar la respuesta del servidor. Revisa tu conexión y reintenta.',
    );
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'No se pudo completar la operación.');
    error.status = response.status;
    throw error;
  }
  return result;
}
