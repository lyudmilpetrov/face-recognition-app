import { configureStore } from '@reduxjs/toolkit';
import mainReducer from '../slice/main-slice';

const store = configureStore({
    reducer: {
        main: mainReducer,
    },
    devTools: import.meta.env.DEV
});

export default store;
