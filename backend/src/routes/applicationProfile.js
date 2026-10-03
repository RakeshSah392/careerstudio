import { Router } from 'express'
import { applicationProfileService } from '../services/applicationProfileService.js'

const router = Router()

// GET /api/application-profile
router.get('/', async (request, response, next) => {
  try {
    const result = await applicationProfileService.getProfileWithCompleteness(request.user.id)
    return response.json({
      ok: true,
      profile: result.profile,
      completeness: result.completeness,
      primaryResume: result.primaryResume,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/application-profile (full upsert)
router.post('/', async (request, response, next) => {
  try {
    const result = await applicationProfileService.saveProfile(request.user.id, request.body ?? {})
    return response.status(200).json({
      ok: true,
      profile: result.profile,
      completeness: result.completeness,
      primaryResume: result.primaryResume,
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/application-profile (partial update)
router.patch('/', async (request, response, next) => {
  try {
    const result = await applicationProfileService.updateProfile(request.user.id, request.body ?? {})
    return response.status(200).json({
      ok: true,
      profile: result.profile,
      completeness: result.completeness,
      primaryResume: result.primaryResume,
    })
  } catch (error) {
    next(error)
  }
})

export default router
