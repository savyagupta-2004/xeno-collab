import { API_ENDPOINTS } from '@/lib/constants';
import { startSession } from '@/lib/startSession';

export const POST = (request) => startSession(request, API_ENDPOINTS.login);
