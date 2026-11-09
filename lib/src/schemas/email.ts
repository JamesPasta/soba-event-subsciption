import { z } from 'zod';

/** The address rule every notification send is checked against. */
export const EmailAddressSchema = z.email();
