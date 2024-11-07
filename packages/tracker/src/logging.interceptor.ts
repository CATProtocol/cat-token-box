import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;
    const requestId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const startTime = Date.now();

    console.log(`[${requestId}] ${method} ${url}`);
    return next.handle().pipe(
      tap(() => {
        const responseTime = Date.now() - startTime;
        console.log(`[${requestId}] Completed in ${responseTime}ms`);
      }),
    );
  }
}
