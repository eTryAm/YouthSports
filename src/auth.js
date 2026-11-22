const TOKEN_KEY = 'cricketlive_admin_session';

export const getAdminToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setAdminToken = (token) => sessionStorage.setItem(TOKEN_KEY, token);
export const clearAdminToken = () => sessionStorage.removeItem(TOKEN_KEY);
export const adminHeaders = () => {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};
