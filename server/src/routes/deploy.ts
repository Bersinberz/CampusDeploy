import { Router } from 'express'
import { createDeployment, cloneDeployment, getDeployments } from '../controllers/deployController.js'
import { deployValidationRules, validate } from '../middleware/validateDeploy.js'

const router = Router()

router.post('/', deployValidationRules, validate, createDeployment)
router.get('/:id/clone', cloneDeployment)
router.get('/', getDeployments)

export default router
