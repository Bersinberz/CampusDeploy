import { body, validationResult } from 'express-validator'
import type { Request, Response, NextFunction } from 'express'

export const deployValidationRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),

  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email address')
    .normalizeEmail(),

  body('repoUrl')
    .trim()
    .notEmpty().withMessage('Repository URL is required')
    .isURL({ protocols: ['https'], require_protocol: true }).withMessage('Must be a valid HTTPS URL')
    .matches(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/)
    .withMessage('Must be a valid GitHub repository URL (e.g. https://github.com/user/repo)'),
]

export const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(422).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.type === 'field' ? e.path : 'unknown', message: e.msg })),
    })
    return
  }
  next()
}