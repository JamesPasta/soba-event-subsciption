'use client';

import { clientOnly } from '@/src/shared/ui/clientOnly';

const FormioV5NewSubmissionLoader = clientOnly(() => import('./FormioV5NewSubmissionClient'));

export default FormioV5NewSubmissionLoader;
