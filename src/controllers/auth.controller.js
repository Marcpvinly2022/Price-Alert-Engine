
import * as authService from "../services/auth.service.js";

export const handleRegister = async (req, res, next) => {
  try {
    const user = await authService.registerUser(req.validatedBody);

    return res.status(201).json({
      status: 'SUCCESS',
      message: 'User registered successfully',
      data: {
        id: user.id,
        email: user.email,
        firstName: user.user_metadata?.first_name || null,
        lastName: user.user_metadata?.last_name || null,
        displayName: user.user_metadata?.display_name || null,
        phone: user.user_metadata?.phone || null,
        emailConfirmed: !!user.email_confirmed_at,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};


export const handleLogin = async (req, res, next) => {
  try {
    const session = await authService.loginUser(req.validatedBody);

    return res.status(200).json({
      status: "SUCCESS",
      data: {
        accessToken: session.session.access_token,
        refreshToken: session.session.refresh_token,
        expiresAt: session.session.expires_at,
        user: {
          id: session.user.id,
          email: session.user.email,
          firstName: session.user.user_metadata.first_name,
          lastName: session.user.user_metadata.last_name,
          displayName: session.user.user_metadata.display_name,
          phone: session.user.user_metadata.phone,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};


// Handle outbound logout requests cleanly
export const handleLogout = async (req, res, next) => {
  try {
    await authService.logoutUser();

    return res.status(200).json({
      status: 'SUCCESS',
      message: 'User logged out successfully',
    });
  } catch (err) {
    next(err);
  }
};
