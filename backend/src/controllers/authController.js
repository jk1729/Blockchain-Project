const authService = require('../services/authService');

class AuthController {
  async register(req, res, next) {
    try {
      const isAdminCreated = Boolean(req.user && req.user.role === 'ADMIN');
      const result = await authService.register({ ...req.body, isAdminCreated });
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const { username, password } = req.body;
      const result = await authService.login(username, password);
      res.status(200).json({
        success: true,
        message: 'Login successful',
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  async getMe(req, res, next) {
    try {
      res.status(200).json({
        success: true,
        user: req.user
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        authService.revokeToken(token);
      }
      res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();

