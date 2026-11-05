// Talks to Cognito directly with fetch (no library needed).
// Requires an App Client with no secret and ALLOW_USER_PASSWORD_AUTH + ALLOW_REFRESH_TOKEN_AUTH.

const COGNITO_URL = `https://cognito-idp.${APP_CONFIG.REGION}.amazonaws.com/`;

async function cognitoCall(action, body) {
  const res = await fetch(COGNITO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.__type || "Cognito request failed");
  }
  return data;
}

// Decodes the payload of a JWT (supports Arabic names / UTF-8).
function decodeJwt(token) {
  const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const Auth = {
  signUp(name, email, password) {
    return cognitoCall("SignUp", {
      ClientId: APP_CONFIG.COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "name", Value: name },
      ],
    });
  },

  confirmSignUp(email, code) {
    return cognitoCall("ConfirmSignUp", {
      ClientId: APP_CONFIG.COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
    });
  },

  resendCode(email) {
    return cognitoCall("ResendConfirmationCode", {
      ClientId: APP_CONFIG.COGNITO_CLIENT_ID,
      Username: email,
    });
  },

  async login(email, password) {
    const data = await cognitoCall("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: APP_CONFIG.COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    const result = data.AuthenticationResult;
    if (!result) throw new Error("Login needs an extra step that this app does not support");
    localStorage.setItem("idToken", result.IdToken);
    localStorage.setItem("refreshToken", result.RefreshToken);
  },

  logout() {
    localStorage.removeItem("idToken");
    localStorage.removeItem("refreshToken");
  },

  // Returns a valid ID token, refreshing it if it is about to expire. Returns null if logged out.
  async getToken() {
    const token = localStorage.getItem("idToken");
    if (!token) return null;

    const { exp } = decodeJwt(token);
    if (exp * 1000 - Date.now() > 60 * 1000) return token;

    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) {
      this.logout();
      return null;
    }
    try {
      const data = await cognitoCall("InitiateAuth", {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: APP_CONFIG.COGNITO_CLIENT_ID,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      });
      localStorage.setItem("idToken", data.AuthenticationResult.IdToken);
      return data.AuthenticationResult.IdToken;
    } catch {
      this.logout();
      return null;
    }
  },

  // Info shown in the UI only. The real permission check happens in Lambda.
  getUser() {
    const token = localStorage.getItem("idToken");
    if (!token) return null;
    const claims = decodeJwt(token);
    return {
      name: claims.name || claims.email,
      email: claims.email,
      groups: claims["cognito:groups"] || [],
    };
  },

  isAdmin() {
    const user = this.getUser();
    return !!user && user.groups.includes("admins");
  },
};
