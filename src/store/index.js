import { configureStore } from '@reduxjs/toolkit';
import mainReducer from '../slice/main-slice';

const store = configureStore({
    reducer: {
        main: mainReducer,
    },
    devTools: process.env.NODE_ENV !== 'production'
});

export default store;