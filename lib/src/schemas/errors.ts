import { z } from 'zod';
import { ApiErrorCodes } from '../permissions/codes';

/** Why an API request failed; an error response carries it as `code`. */
export const ApiErrorCodeSchema = z.enum(ApiErrorCodes);
