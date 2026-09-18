#include <node_api.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
extern int32_t betterlearn_set_glass(void *, double);
static napi_value set_glass(napi_env env, napi_callback_info info) {
  size_t count = 2, size = 0; napi_value args[2], result;
  void *bytes = NULL, *handle = NULL; double frost = 0; bool buffer = false;
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  if (count != 2 || napi_is_buffer(env,args[0],&buffer) != napi_ok || !buffer ||
      napi_get_buffer_info(env,args[0],&bytes,&size) != napi_ok || size != sizeof(void *) ||
      napi_get_value_double(env,args[1],&frost) != napi_ok || !isfinite(frost)) {
    napi_throw_type_error(env,NULL,"Invalid native glass arguments"); return NULL;
  }
  memcpy(&handle,bytes,sizeof(handle));
  napi_get_boolean(env,betterlearn_set_glass(handle,frost) == 1,&result); return result;
}
NAPI_MODULE_INIT() {
  napi_value fn; napi_create_function(env,"setGlass",NAPI_AUTO_LENGTH,set_glass,NULL,&fn);
  napi_set_named_property(env,exports,"setGlass",fn); return exports;
}
