enum LogLevel {
  Info = 0,
  Error = 1,
  ErrorWithStack = 2,
}

const logLevel: LogLevel = LogLevel.Error;

export function logerror(label: string, e: Error) {
  if (logLevel === LogLevel.ErrorWithStack) {
    console.error(label);
    console.error(e);
  } else if (logLevel === LogLevel.Error) {
    console.error(label);
    console.error(e.message);
  } else {
    console.error(label);
  }
}

export function logwarn(label: string, e: Error) {
  if (logLevel === LogLevel.Error) {
    console.warn(label);
    console.warn(e.message);
  } else {
    console.warn(label);
  }
}

export function log(message: string, ...optionalParams: any[]) {
  console.log(message, ...optionalParams);
}
