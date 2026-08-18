import { supabase } from '../config/supabase.js'

// src/services/auth.service.js
export const registerUser = async (payload) => {

   console.log('[REGISTER] Enter service');
    const {
        firstName,
        lastName,
        displayName,
        phone,
        email,
        password,
        } = payload;
  const result = await supabase.auth.signUp({
    email: payload.email,
    password: payload.password,
    options: {
      data: {
        first_name: payload.firstName,
        last_name: payload.lastName,
        display_name: payload.displayName,
        phone: payload.phone,
      },
    },
  });

  const { data, error } = result;

  if (error) {
    const err = new Error(error.message);

    if (error.message === 'User already registered') {
      err.statusCode = 409;
      err.code = 'USER_ALREADY_EXISTS';
    } else {
      err.statusCode = 400;
      err.code = 'AUTH_REGISTER_FAILED';
    }

    throw err;
  }

  return data.user;
};


export const loginUser = async ({email, password}) => {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if(error){
        const err = new Error(error.message);
        err.statusCode = 401;
        throw err;
    }

    return data;
}


// Log out the current user session from Supabase
export const logoutUser = async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    const err = new Error(error.message);
    err.statusCode = 400;
    err.code = 'AUTH_LOGOUT_FAILED';
    throw err;
  }

  return true;
};
