import express from 'express';
import { validateRequest } from '../shared/validation';
import { getCurrentActor, getCurrentActorTenants, patchCurrentActor } from './controller';
import { PatchMeBodySchema } from './schema';

const router = express.Router();

router.get('/me', getCurrentActor);
router.patch('/me', validateRequest({ body: PatchMeBodySchema }), patchCurrentActor);
router.get('/me/tenants', getCurrentActorTenants);

export { router as meRouter };
