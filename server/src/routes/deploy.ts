import { Router } from 'express'
import { createDeployment, cloneDeployment, getDeployments } from '../controllers/deployController.js'

const router = Router()

router.post('/', createDeployment)
router.get('/:id/clone', cloneDeployment)
router.get('/', getDeployments)

export default router
