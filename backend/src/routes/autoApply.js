import { Router } from 'express'
import { autoApplyService } from '../services/autoApplyService.js'

const router = Router()

// GET /api/auto-apply
router.get('/', async (request, response, next) => {
  try {
    const settings = await autoApplyService.getSettings(request.user.id)
    return response.json({
      ok: true,
      settings,
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/auto-apply
router.patch('/', async (request, response, next) => {
  try {
    const settings = await autoApplyService.updateSettings(request.user.id, request.body ?? {})
    return response.json({
      ok: true,
      settings,
    })
  } catch (error) {
    next(error)
  }
})

export default router
